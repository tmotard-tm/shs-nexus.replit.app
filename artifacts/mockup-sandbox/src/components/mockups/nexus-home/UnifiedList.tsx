import { useState } from "react";
import {
  LayoutGrid, UserMinus, UserPlus, MapPin, Plus, Wrench,
  CalendarPlus, CalendarMinus, Car, BarChart3, TrendingUp,
  AlertTriangle, Phone, DollarSign, ListChecks, Truck,
  ParkingCircle, FileText, Receipt, Trash2, Search,
  Home, ChevronRight, ChevronDown, Bell,
} from "lucide-react";

const sections = [
  {
    id: "action-center",
    label: "Action Center",
    items: [
      { label: "Task Queue", desc: "4 items pending", icon: LayoutGrid, badge: "4", color: "bg-slate-600" },
    ],
  },
  {
    id: "fleet-operations",
    label: "Fleet Operations",
    items: [
      { label: "Fleet Management", desc: "Assign & update vehicles", icon: MapPin, badge: null, color: "bg-green-600" },
      { label: "Fleet Scope", desc: "Rentals, repairs, decommissioning", icon: Wrench, badge: null, color: "bg-amber-600" },
      { label: "Create New Vehicle", desc: "Add a vehicle to the system", icon: Plus, badge: null, color: "bg-blue-600" },
      { label: "All Vehicles", desc: "1,204 vehicles in fleet", icon: Car, badge: null, color: "bg-slate-500" },
      { label: "Spares", desc: "Manage spare units", icon: Truck, badge: null, color: "bg-teal-600" },
      { label: "Registration", desc: "Reg stickers & expiry tracking", icon: FileText, badge: null, color: "bg-sky-600" },
    ],
  },
  {
    id: "people",
    label: "People Workflows",
    items: [
      { label: "Onboarding", desc: "7 pending new hires", icon: UserPlus, badge: "7", color: "bg-purple-600" },
      { label: "Offboarding", desc: "2 active departures", icon: UserMinus, badge: "2", color: "bg-red-600" },
      { label: "Weekly Onboarding", desc: "Batch processing", icon: CalendarPlus, badge: null, color: "bg-cyan-600" },
      { label: "Weekly Offboarding", desc: "Batch processing", icon: CalendarMinus, badge: null, color: "bg-rose-600" },
    ],
  },
  {
    id: "intelligence",
    label: "Intelligence",
    items: [
      { label: "Metrics Dashboard", desc: "KPIs and trend analysis", icon: TrendingUp, badge: null, color: "bg-violet-600" },
      { label: "Fleet Cost", desc: "Repair & operational costs", icon: DollarSign, badge: null, color: "bg-emerald-600" },
      { label: "Executive Summary", desc: "Leadership-level overview", icon: BarChart3, badge: null, color: "bg-indigo-600" },
      { label: "Discrepancy Finder", desc: "Data inconsistency detection", icon: AlertTriangle, badge: null, color: "bg-orange-600" },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    items: [
      { label: "Holman Research", desc: "Look up repair status & POs", icon: Wrench, badge: null, color: "bg-stone-600" },
      { label: "Batch Caller", desc: "Auto-dial tech phone list", icon: Phone, badge: null, color: "bg-lime-700" },
      { label: "Action Tracker", desc: "Open action items across fleet", icon: ListChecks, badge: null, color: "bg-zinc-600" },
    ],
  },
];

export function UnifiedList() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    Object.fromEntries(sections.map((s) => [s.id, true]))
  );

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground text-sm">
      {/* Header */}
      <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border bg-background px-4">
        <Home className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">Home</span>
        <div className="ml-auto flex items-center gap-3">
          <button className="relative text-muted-foreground hover:text-foreground">
            <Bell className="h-4 w-4" />
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-destructive rounded-full"></span>
          </button>
          <div className="h-4 w-px bg-border"></div>
          <span className="text-xs text-muted-foreground">Admin</span>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        {/* Hero strip */}
        <div className="border-b border-border px-6 py-4 flex items-center justify-between bg-muted/20">
          <div>
            <h1 className="text-base font-semibold text-foreground">Nexus: Your Business, Synced.</h1>
            <p className="text-xs text-muted-foreground mt-0.5">All modules and workflows in one place.</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
              <span>API Gateway</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
              <span>Snowflake</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400"></div>
              <span>APIs 9/11</span>
            </div>
          </div>
        </div>

        {/* Two-column content */}
        <div className="max-w-4xl mx-auto px-6 py-6 grid grid-cols-2 gap-x-8 gap-y-6">
          {sections.map((section) => {
            const isOpen = expanded[section.id];
            return (
              <div key={section.id} className={section.id === "fleet-operations" ? "col-span-2" : ""}>
                {/* Section header */}
                <button
                  onClick={() => toggle(section.id)}
                  className="flex items-center gap-2 w-full mb-2 group"
                >
                  <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex-1 text-left">
                    {section.label}
                  </h2>
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>

                {isOpen && (
                  <div className={`space-y-1 ${section.id === "fleet-operations" ? "grid grid-cols-3 gap-2 space-y-0" : ""}`}>
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.label}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:bg-accent text-left transition-colors group"
                        >
                          <div className={`w-7 h-7 rounded-md ${item.color} flex items-center justify-center flex-shrink-0`}>
                            <Icon className="h-3.5 w-3.5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{item.label}</p>
                            <p className="text-xs text-muted-foreground truncate">{item.desc}</p>
                          </div>
                          {item.badge && (
                            <span className="bg-primary text-primary-foreground text-xs rounded-full px-1.5 py-0.5 leading-none flex-shrink-0">{item.badge}</span>
                          )}
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
