import { useState } from "react";
import {
  LayoutGrid, UserMinus, UserPlus, MapPin, Plus, Wrench,
  CalendarPlus, CalendarMinus, Car, BarChart3, TrendingUp,
  DollarSign, ListChecks, AlertTriangle, Phone, Truck,
  ParkingCircle, FileText, Receipt, Trash2, Search, Home,
  ChevronRight, PanelLeft,
} from "lucide-react";

const navGroups = [
  {
    label: "Action Center",
    items: [{ title: "Task Queue", icon: LayoutGrid, badge: 4 }],
  },
  {
    label: "Fleet Operations",
    items: [
      { title: "All Vehicles", icon: Car },
      { title: "Vehicle Search", icon: Search },
      { title: "Spares", icon: Truck },
      { title: "Park My Fleet", icon: ParkingCircle },
      { title: "Registration", icon: FileText },
    ],
  },
  {
    label: "Repair Pipeline",
    items: [
      { title: "Rentals Dashboard", icon: LayoutGrid },
      { title: "Purchase Orders", icon: Receipt },
      { title: "Decommissioning", icon: Trash2 },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { title: "Discrepancy Finder", icon: AlertTriangle },
      { title: "Fleet Cost", icon: DollarSign },
      { title: "Executive Summary", icon: BarChart3 },
      { title: "Metrics Dashboard", icon: TrendingUp },
    ],
  },
  {
    label: "Tools",
    items: [
      { title: "Holman Research", icon: Wrench },
      { title: "Batch Caller", icon: Phone },
      { title: "Action Tracker", icon: ListChecks },
    ],
  },
];

const quickActions = [
  { label: "Task Queue", icon: LayoutGrid, color: "bg-slate-600 hover:bg-slate-700" },
  { label: "Offboarding", icon: UserMinus, color: "bg-red-600 hover:bg-red-700" },
  { label: "Onboarding", icon: UserPlus, color: "bg-purple-600 hover:bg-purple-700" },
  { label: "Fleet Management", icon: MapPin, color: "bg-green-600 hover:bg-green-700" },
  { label: "Weekly Onboarding", icon: CalendarPlus, color: "bg-cyan-600 hover:bg-cyan-700" },
  { label: "Weekly Offboarding", icon: CalendarMinus, color: "bg-rose-600 hover:bg-rose-700" },
  { label: "Create New Vehicle", icon: Plus, color: "bg-blue-600 hover:bg-blue-700" },
  { label: "Fleet Scope", icon: Wrench, color: "bg-amber-600 hover:bg-amber-700" },
];

export function SidebarLaunch() {
  const [collapsed, setCollapsed] = useState(false);
  const [activeItem, setActiveItem] = useState<string | null>(null);

  return (
    <div className="min-h-screen flex bg-background text-foreground text-sm">
      {/* Sidebar */}
      <aside className={`flex flex-col border-r border-border bg-sidebar ${collapsed ? "w-12" : "w-52"} transition-all duration-200 flex-shrink-0`}>
        <div className="flex items-center gap-2 border-b border-border px-3 py-3 h-12">
          <button onClick={() => setCollapsed(!collapsed)} className="rounded p-1 hover:bg-accent text-muted-foreground flex-shrink-0">
            <PanelLeft className="h-4 w-4" />
          </button>
          {!collapsed && <span className="text-sm font-semibold truncate">Nexus</span>}
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-1">
              {!collapsed && (
                <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">{group.label}</p>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeItem === item.title;
                return (
                  <button
                    key={item.title}
                    onClick={() => setActiveItem(item.title)}
                    title={collapsed ? item.title : undefined}
                    className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors ${active ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {!collapsed && (
                      <span className="truncate">{item.title}</span>
                    )}
                    {!collapsed && (item as any).badge && (
                      <span className="ml-auto bg-primary text-primary-foreground text-xs rounded-full px-1.5 py-0.5 leading-none">{(item as any).badge}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="border-t border-border px-3 py-2">
          {!collapsed ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">AD</div>
              <span className="truncate">Admin</span>
            </div>
          ) : (
            <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium mx-auto">AD</div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header */}
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border bg-background px-4">
          <Home className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground text-sm">/</span>
          <span className="text-sm font-medium">Home</span>
        </header>

        <main className="flex-1 overflow-auto p-6">
          {/* Tagline */}
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-foreground">Nexus: Your Business, Synced.</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Select a workflow to get started, or navigate using the sidebar.</p>
          </div>

          {/* Quick action grid */}
          <div className="grid grid-cols-4 gap-3 mb-8 max-w-2xl">
            {quickActions.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.label}
                  className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-accent transition-colors"
                >
                  <div className={`w-10 h-10 rounded-lg ${a.color} flex items-center justify-center`}>
                    <Icon className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-xs text-center text-foreground font-medium leading-tight">{a.label}</span>
                </button>
              );
            })}
          </div>

          {/* Module shortcuts */}
          <div className="max-w-2xl">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Modules</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Fleet Scope", desc: "Rentals, repairs, decommissioning", href: "/fleet-scope", icon: Wrench, badge: null },
                { label: "Fleet Management", desc: "Vehicle assignments & tracking", href: "/fleet-management", icon: Car, badge: null },
                { label: "Operations Dashboard", desc: "Cross-system ops overview", href: "/operations", icon: BarChart3, badge: null },
                { label: "Integrations", desc: "Holman, Snowflake, PARQ & more", href: "/integrations", icon: TrendingUp, badge: "4 active" },
              ].map((m) => {
                const Icon = m.icon;
                return (
                  <button key={m.label} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent/50 text-left transition-colors group">
                    <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{m.label}</p>
                      <p className="text-xs text-muted-foreground truncate">{m.desc}</p>
                    </div>
                    {m.badge && <span className="text-xs text-muted-foreground">{m.badge}</span>}
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
