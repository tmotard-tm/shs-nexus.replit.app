import { useState } from "react";
import {
  LayoutGrid, UserMinus, UserPlus, MapPin, Plus, Wrench,
  CalendarPlus, CalendarMinus, Car, BarChart3, TrendingUp,
  AlertTriangle, Phone, Truck, Home, ChevronRight,
  ArrowRight, Bell,
} from "lucide-react";

type TabId = "home" | "fleet" | "people" | "intelligence" | "tools";

const tabs: { id: TabId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "fleet", label: "Fleet Operations" },
  { id: "people", label: "People" },
  { id: "intelligence", label: "Intelligence" },
  { id: "tools", label: "Tools" },
];

const quickActions = [
  { label: "Task Queue", icon: LayoutGrid, color: "bg-slate-600 hover:bg-slate-700", badge: "4" },
  { label: "Offboarding", icon: UserMinus, color: "bg-red-600 hover:bg-red-700", badge: null },
  { label: "Onboarding", icon: UserPlus, color: "bg-purple-600 hover:bg-purple-700", badge: null },
  { label: "Fleet Management", icon: MapPin, color: "bg-green-600 hover:bg-green-700", badge: null },
  { label: "Weekly Onboarding", icon: CalendarPlus, color: "bg-cyan-600 hover:bg-cyan-700", badge: null },
  { label: "Weekly Offboarding", icon: CalendarMinus, color: "bg-rose-600 hover:bg-rose-700", badge: null },
  { label: "Create New Vehicle", icon: Plus, color: "bg-blue-600 hover:bg-blue-700", badge: null },
  { label: "Fleet Scope", icon: Wrench, color: "bg-amber-600 hover:bg-amber-700", badge: null },
];

export function HeaderNav() {
  const [activeTab, setActiveTab] = useState<TabId>("home");

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground text-sm">
      {/* Top header */}
      <header className="sticky top-0 z-20 border-b border-border bg-background">
        {/* Brand + actions */}
        <div className="flex h-12 items-center gap-2 px-4 justify-between">
          <div className="flex items-center gap-2">
            <Home className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground text-sm">/</span>
            <span className="text-sm font-semibold">Nexus</span>
          </div>
          <div className="flex items-center gap-3">
            <button className="relative text-muted-foreground hover:text-foreground">
              <Bell className="h-4 w-4" />
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-destructive rounded-full"></span>
            </button>
            <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">AD</div>
          </div>
        </div>
        {/* Tab bar */}
        <div className="flex px-4 gap-1 -mb-px overflow-x-auto">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2 text-sm border-b-2 whitespace-nowrap transition-colors ${active ? "border-foreground text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        {activeTab === "home" && (
          <div className="max-w-3xl space-y-8">
            <div>
              <h1 className="text-xl font-semibold text-foreground">Nexus: Your Business, Synced.</h1>
              <p className="text-sm text-muted-foreground mt-0.5">All your fleet operations, people workflows, and integrations in one place.</p>
            </div>

            {/* Quick actions */}
            <div>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Quick Actions</h2>
              <div className="grid grid-cols-4 gap-3">
                {quickActions.map((a) => {
                  const Icon = a.icon;
                  return (
                    <button key={a.label} className="relative flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-accent transition-colors">
                      {a.badge && (
                        <span className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs rounded-full w-4 h-4 flex items-center justify-center">{a.badge}</span>
                      )}
                      <div className={`w-10 h-10 rounded-lg ${a.color} flex items-center justify-center transition-colors`}>
                        <Icon className="h-5 w-5 text-white" />
                      </div>
                      <span className="text-xs text-center text-foreground font-medium leading-tight">{a.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Recent activity */}
            <div>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Recent Activity</h2>
              <div className="border border-border rounded-lg divide-y divide-border">
                {[
                  { desc: "Vehicle #2341 assigned to J. Martinez", time: "2m ago", type: "Fleet" },
                  { desc: "Onboarding started — K. Thompson", time: "14m ago", type: "People" },
                  { desc: "TPMS alert: Unit #1887 pressure low", time: "31m ago", type: "Alert" },
                  { desc: "Offboarding completed — R. Davis", time: "1h ago", type: "People" },
                  { desc: "Fleet sync completed — 1,204 records", time: "3h ago", type: "System" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.type === "Alert" ? "bg-amber-500" : item.type === "System" ? "bg-blue-500" : "bg-emerald-500"}`}></div>
                    <span className="flex-1 text-sm text-foreground">{item.desc}</span>
                    <span className="text-xs text-muted-foreground">{item.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "fleet" && (
          <div className="max-w-3xl space-y-4">
            <h1 className="text-lg font-semibold">Fleet Operations</h1>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "All Vehicles", desc: "Full fleet inventory", icon: Car },
                { label: "Fleet Management", desc: "Assignments & updates", icon: MapPin },
                { label: "Spares Management", desc: "Track spare vehicles", icon: Truck },
                { label: "Create New Vehicle", desc: "Add to fleet system", icon: Plus },
                { label: "Registration", desc: "Reg stickers & expiry", icon: LayoutGrid },
                { label: "Fleet Scope", desc: "Rentals & repair pipeline", icon: Wrench },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.label} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent text-left transition-colors group">
                    <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "people" && (
          <div className="max-w-3xl space-y-4">
            <h1 className="text-lg font-semibold">People Workflows</h1>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Onboarding", desc: "New hire workflow", icon: UserPlus, color: "bg-purple-600" },
                { label: "Offboarding", desc: "Employee departure", icon: UserMinus, color: "bg-red-600" },
                { label: "Weekly Onboarding", desc: "Batch weekly processing", icon: CalendarPlus, color: "bg-cyan-600" },
                { label: "Weekly Offboarding", desc: "Batch weekly processing", icon: CalendarMinus, color: "bg-rose-600" },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.label} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent text-left transition-colors group">
                    <div className={`w-8 h-8 rounded-lg ${item.color} flex items-center justify-center flex-shrink-0`}>
                      <Icon className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {(activeTab === "intelligence" || activeTab === "tools") && (
          <div className="max-w-3xl">
            <h1 className="text-lg font-semibold mb-4">{activeTab === "intelligence" ? "Intelligence" : "Tools"}</h1>
            <div className="grid grid-cols-2 gap-3">
              {(activeTab === "intelligence"
                ? [
                    { label: "Discrepancy Finder", icon: AlertTriangle },
                    { label: "Fleet Cost", icon: BarChart3 },
                    { label: "Executive Summary", icon: TrendingUp },
                    { label: "Metrics Dashboard", icon: TrendingUp },
                  ]
                : [
                    { label: "Holman Research", icon: Wrench },
                    { label: "Batch Caller", icon: Phone },
                    { label: "Action Tracker", icon: LayoutGrid },
                  ]
              ).map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.label} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent text-left transition-colors group">
                    <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm font-medium">{item.label}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
