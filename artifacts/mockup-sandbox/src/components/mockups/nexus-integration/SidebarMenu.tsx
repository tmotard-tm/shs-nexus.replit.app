import {
  Home, BarChart3, Clock, Settings, Activity, Key, HelpCircle,
  Wrench, ChevronRight, Truck, PhoneCall, DollarSign, Trash2,
  FileText, LogOut, Moon, Eye, Users, MapPin, FileCode,
  Car, Search, ParkingCircle, Receipt, AlertTriangle, TrendingUp,
  ListChecks, ClipboardList,
} from "lucide-react";

const fleetScopeGroups = [
  {
    label: "Action Center",
    items: [
      { label: "Today's Queue", icon: ClipboardList },
    ],
  },
  {
    label: "Fleet Operations",
    items: [
      { label: "All Vehicles",   icon: Car },
      { label: "Vehicle Search", icon: Search },
      { label: "Spares",         icon: Truck },
      { label: "Park My Fleet",  icon: ParkingCircle },
      { label: "Registration",   icon: FileText },
    ],
  },
  {
    label: "Repair Pipeline",
    items: [
      { label: "Rentals Dashboard", icon: BarChart3 },
      { label: "Purchase Orders",   icon: Receipt },
      { label: "Decommissioning",   icon: Trash2 },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { label: "Discrepancy Finder",  icon: AlertTriangle },
      { label: "Fleet Cost",          icon: DollarSign },
      { label: "Executive Summary",   icon: BarChart3 },
      { label: "Metrics Dashboard",   icon: TrendingUp },
    ],
  },
  {
    label: "Tools",
    items: [
      { label: "Holman Research", icon: Wrench },
      { label: "Batch Caller",    icon: PhoneCall },
      { label: "Action Tracker",  icon: ListChecks },
    ],
  },
];

const nexusCategories = [
  { label: "Dashboards", icon: BarChart3 },
  { label: "Queues",     icon: Clock },
  { label: "Management", icon: Settings },
  { label: "Activity",   icon: Activity },
  { label: "Account",    icon: Key },
  { label: "Help",       icon: HelpCircle },
];

export function SidebarMenu() {
  return (
    <div
      className="min-h-screen flex items-start justify-center pt-10 pb-8"
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        fontFamily: "'Poppins', system-ui, sans-serif",
      }}
    >
      <div className="relative flex items-start gap-0">
        {/* ── Left panel: Nexus nav dropdown ── */}
        <div
          className="w-64 rounded-xl border border-zinc-700/60 bg-zinc-900 shadow-2xl overflow-hidden"
          style={{ boxShadow: "0 25px 50px rgba(0,0,0,0.6)" }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-3 py-2.5 border-b border-zinc-700/60">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <Settings className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-sm text-white" style={{ fontFamily: "'Montserrat', system-ui" }}>
              Nexus
            </span>
            <div className="ml-auto w-7 h-7 rounded-md border border-zinc-600 bg-zinc-800 flex items-center justify-center">
              <Moon className="w-3.5 h-3.5 text-zinc-400" />
            </div>
          </div>

          {/* Role badge */}
          <div className="px-3 py-2 border-b border-zinc-700/60">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-zinc-800 text-xs text-zinc-300">
              <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                <span className="text-[8px] font-bold text-white">D</span>
              </div>
              <span>Developer</span>
            </div>
          </div>

          {/* Home */}
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 cursor-pointer">
            <Home className="w-4 h-4 flex-shrink-0" />
            <span>Home</span>
          </div>

          <div className="h-px bg-zinc-700/40 my-0.5" />

          {/* Existing Nexus categories */}
          {nexusCategories.map((cat) => {
            const CatIcon = cat.icon;
            return (
              <div
                key={cat.label}
                className="flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 cursor-pointer"
              >
                <CatIcon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{cat.label}</span>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
              </div>
            );
          })}

          <div className="h-px bg-zinc-700/40 my-0.5" />

          {/* Fleet Scope — highlighted, hovered state showing arrow */}
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-amber-300 bg-amber-500/15 cursor-pointer">
            <Wrench className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">Fleet Scope</span>
            <span className="text-[9px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full leading-tight">
              NEW
            </span>
            <ChevronRight className="w-3.5 h-3.5 text-amber-400" />
          </div>

          <div className="h-px bg-zinc-700/40 my-0.5" />

          {/* View as Role + Log out */}
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 cursor-pointer">
            <Eye className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">View as Role</span>
            <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
          </div>
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 cursor-pointer">
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span>Log out</span>
          </div>
        </div>

        {/* ── Right panel: Fleet Scope submenu ── */}
        <div
          className="w-56 rounded-r-xl border border-l-0 border-zinc-700/60 bg-zinc-850 shadow-2xl overflow-hidden"
          style={{
            background: "#18212f",
            boxShadow: "8px 25px 50px rgba(0,0,0,0.5)",
            marginTop: "0px",
            alignSelf: "flex-start",
            // Position it to the right, aligned with Fleet Scope row
            marginTop: "266px",
          }}
        >
          {/* Submenu header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-700/60">
            <Wrench className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <span className="text-xs font-semibold text-amber-300" style={{ fontFamily: "'Montserrat', system-ui" }}>
              Fleet Scope
            </span>
          </div>

          {/* Groups with section headers */}
          <div className="py-1 max-h-[520px] overflow-y-auto">
            {fleetScopeGroups.map((group, gi) => (
              <div key={group.label} className={gi > 0 ? "mt-1" : ""}>
                {/* Section header */}
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {group.label}
                </p>
                {/* Items */}
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.label === "All Vehicles";
                  return (
                    <div
                      key={item.label}
                      className={`flex items-center gap-2.5 px-3 py-1.5 text-xs cursor-pointer transition-colors
                        ${isActive
                          ? "text-amber-300 bg-amber-500/15 font-medium"
                          : "text-zinc-300 hover:bg-zinc-700/50"
                        }`}
                    >
                      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? "text-amber-400" : "text-zinc-400"}`} />
                      <span>{item.label}</span>
                    </div>
                  );
                })}
                {gi < fleetScopeGroups.length - 1 && (
                  <div className="h-px bg-zinc-700/30 mx-3 mt-1.5" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
