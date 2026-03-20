import { useState } from "react";
import {
  LayoutGrid, UserMinus, UserPlus, MapPin, Plus, Wrench,
  CalendarPlus, CalendarMinus, Car, BarChart3, TrendingUp,
  AlertTriangle, Phone, DollarSign, ListChecks, Truck,
  Home, ChevronRight, Activity, Bell, Search, Users,
} from "lucide-react";

const workflowTiles = [
  { label: "Task Queue", icon: LayoutGrid, color: "bg-slate-600 hover:bg-slate-700", badge: "4" },
  { label: "Offboarding", icon: UserMinus, color: "bg-red-600 hover:bg-red-700", badge: null },
  { label: "Onboarding", icon: UserPlus, color: "bg-purple-600 hover:bg-purple-700", badge: null },
  { label: "Fleet Management", icon: MapPin, color: "bg-green-600 hover:bg-green-700", badge: null },
  { label: "Weekly Onboarding", icon: CalendarPlus, color: "bg-cyan-600 hover:bg-cyan-700", badge: null },
  { label: "Weekly Offboarding", icon: CalendarMinus, color: "bg-rose-600 hover:bg-rose-700", badge: null },
  { label: "Create New Vehicle", icon: Plus, color: "bg-blue-600 hover:bg-blue-700", badge: null },
  { label: "Fleet Scope", icon: Wrench, color: "bg-amber-600 hover:bg-amber-700", badge: null },
];

const modules = [
  { label: "All Vehicles", desc: "1,204 vehicles tracked", icon: Car, color: "text-blue-500" },
  { label: "Fleet Scope", desc: "Rentals · Repairs · Decommissions", icon: Wrench, color: "text-amber-500" },
  { label: "Operations", desc: "Cross-system overview", icon: Activity, color: "text-emerald-500" },
  { label: "Intelligence", desc: "Cost, metrics & discrepancies", icon: BarChart3, color: "text-violet-500" },
  { label: "Integrations", desc: "Holman · Snowflake · PARQ · TPMS", icon: TrendingUp, color: "text-cyan-500" },
  { label: "People", desc: "48 active techs", icon: Users, color: "text-pink-500" },
];

export function CommandConsole() {
  const [searchVal, setSearchVal] = useState("");

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground text-sm">
      {/* Compact header */}
      <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border bg-background px-4">
        <Home className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">Home</span>
        <div className="flex-1 mx-4 max-w-sm">
          <div className="flex items-center gap-2 h-7 px-2.5 rounded-md border border-border bg-muted/40 text-muted-foreground">
            <Search className="h-3 w-3 flex-shrink-0" />
            <input
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              placeholder="Search modules, vehicles, people..."
              className="bg-transparent outline-none text-xs flex-1 text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button className="relative text-muted-foreground hover:text-foreground">
            <Bell className="h-4 w-4" />
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-destructive rounded-full"></span>
          </button>
          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">AD</div>
        </div>
      </header>

      {/* Console banner */}
      <div className="border-b border-border bg-muted/20 px-6 py-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Nexus: Your Business, Synced.</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Fleet management · People workflows · System integrations</p>
          </div>
          <div className="flex items-center gap-6 text-right">
            {[
              { label: "Fleet Active", value: "1,204" },
              { label: "Pending Actions", value: "23" },
              { label: "Online Users", value: "48" },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-lg font-semibold text-foreground leading-none">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <main className="flex-1 overflow-auto p-6 space-y-6">
        {/* Quick action tiles */}
        <div>
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Quick Actions</h2>
          <div className="grid grid-cols-8 gap-2">
            {workflowTiles.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.label}
                  className="relative flex flex-col items-center gap-1.5 p-2.5 rounded-lg hover:bg-accent transition-colors"
                >
                  {a.badge && (
                    <span className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground text-xs rounded-full w-4 h-4 flex items-center justify-center text-[10px] leading-none">{a.badge}</span>
                  )}
                  <div className={`w-9 h-9 rounded-lg ${a.color} flex items-center justify-center transition-colors`}>
                    <Icon className="h-4.5 w-4.5 text-white" />
                  </div>
                  <span className="text-[10px] text-center text-foreground font-medium leading-tight">{a.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Modules */}
          <div>
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Modules</h2>
            <div className="space-y-1.5">
              {modules.map((m) => {
                const Icon = m.icon;
                return (
                  <button key={m.label} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:bg-accent text-left transition-colors group">
                    <Icon className={`h-4 w-4 flex-shrink-0 ${m.color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{m.label}</p>
                      <p className="text-xs text-muted-foreground">{m.desc}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right col: status + activity */}
          <div className="space-y-5">
            <div>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">System Status</h2>
              <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                {[
                  { name: "API Gateway", status: "Healthy", ok: true },
                  { name: "Snowflake DB", status: "Connected", ok: true },
                  { name: "External APIs", status: "9/11 Active", ok: false },
                  { name: "Authentication", status: "Online", ok: true },
                ].map((s) => (
                  <div key={s.name} className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${s.ok ? "bg-emerald-500" : "bg-amber-400 animate-pulse"}`}></div>
                      <span className="text-sm">{s.name}</span>
                    </div>
                    <span className={`text-xs ${s.ok ? "text-emerald-600" : "text-amber-600"}`}>{s.status}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Live Activity</h2>
              <div className="space-y-2">
                {[
                  { desc: "Vehicle #2341 → J. Martinez", time: "2m ago", ok: true },
                  { desc: "TPMS: Unit #1887 pressure low", time: "31m ago", ok: false },
                  { desc: "K. Thompson onboarding started", time: "14m ago", ok: true },
                  { desc: "R. Davis offboarding complete", time: "1h ago", ok: true },
                ].map((a, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${a.ok ? "bg-emerald-500" : "bg-amber-400"}`}></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground">{a.desc}</p>
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{a.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
