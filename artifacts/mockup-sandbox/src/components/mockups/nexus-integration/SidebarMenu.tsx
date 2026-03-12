import {
  Car, LayoutDashboard, ClipboardList, Search, Truck,
  ParkingCircle, FileText, Receipt, Trash2, BarChart3,
  TrendingUp, DollarSign, Wrench, ListChecks, AlertTriangle, Phone,
  CheckCircle, Package, AlertCircle
} from "lucide-react";

const navGroups = [
  {
    label: "Action Center",
    items: [{ title: "Today's Queue", href: "/queue", icon: ClipboardList }],
  },
  {
    label: "Fleet Operations",
    items: [
      { title: "All Vehicles",    href: "/",               icon: Car },
      { title: "Vehicle Search",  href: "/vehicle-search", icon: Search },
      { title: "Spares",          href: "/spares",         icon: Truck },
      { title: "Park My Fleet",   href: "/pmf",            icon: ParkingCircle },
      { title: "Registration",    href: "/registration",   icon: FileText },
    ],
  },
  {
    label: "Repair Pipeline",
    items: [
      { title: "Rentals Dashboard", href: "/dashboard",       icon: LayoutDashboard },
      { title: "Purchase Orders",   href: "/pos",             icon: Receipt },
      { title: "Decommissioning",   href: "/decommissioning", icon: Trash2 },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { title: "Discrepancy Finder",   href: "/discrepancies",      icon: AlertTriangle },
      { title: "Fleet Cost",           href: "/fleet-cost",          icon: DollarSign },
      { title: "Executive Summary",    href: "/executive-summary",   icon: BarChart3 },
      { title: "Metrics Dashboard",    href: "/metrics",             icon: TrendingUp },
    ],
  },
  {
    label: "Tools",
    items: [
      { title: "Holman Research", href: "/holman-research", icon: Wrench },
      { title: "Batch Caller",    href: "/batch-caller",   icon: Phone },
      { title: "Action Tracker",  href: "/action-tracker", icon: ListChecks },
    ],
  },
];

const summaryCards = [
  { label: "Total",      value: "1,247", icon: Package,      color: "text-blue-600",   bg: "bg-blue-50" },
  { label: "On Road",    value: "803",   icon: Car,          color: "text-green-600",  bg: "bg-green-50" },
  { label: "Repair Shop",value: "38",    icon: Wrench,       color: "text-orange-600", bg: "bg-orange-50" },
  { label: "PMF",        value: "61",    icon: ParkingCircle,color: "text-purple-600", bg: "bg-purple-50" },
  { label: "BYOV",       value: "144",   icon: CheckCircle,  color: "text-cyan-600",   bg: "bg-cyan-50" },
  { label: "Other",      value: "201",   icon: AlertCircle,  color: "text-gray-600",   bg: "bg-gray-50" },
];

const tableRows = [
  { vehicle: "088025", status: "On Road",     substatus: "Assigned",           district: "District 01", location: "Chicago, IL",    badge: "bg-green-100 text-green-800" },
  { vehicle: "061547", status: "Repair Shop", substatus: "Awaiting Estimate",  district: "District 14", location: "Houston, TX",    badge: "bg-orange-100 text-orange-800" },
  { vehicle: "046838", status: "PMF",         substatus: "Pending Arrival",    district: "District 07", location: "Phoenix, AZ",    badge: "bg-purple-100 text-purple-800" },
  { vehicle: "021953", status: "On Road",     substatus: "Assigned",           district: "District 03", location: "Atlanta, GA",    badge: "bg-green-100 text-green-800" },
  { vehicle: "036271", status: "Repair Shop", substatus: "Under Repair",       district: "District 22", location: "Seattle, WA",    badge: "bg-red-100 text-red-800" },
  { vehicle: "061377", status: "BYOV",        substatus: "Enrolled",           district: "District 11", location: "Dallas, TX",     badge: "bg-cyan-100 text-cyan-800" },
  { vehicle: "047135", status: "On Road",     substatus: "Unassigned",         district: "District 05", location: "Denver, CO",     badge: "bg-yellow-100 text-yellow-800" },
];

export function SidebarMenu() {
  return (
    <div
      className="flex h-screen bg-background overflow-hidden"
      style={{ fontFamily: "'Poppins', system-ui, sans-serif", fontSize: "13px" }}
    >
      {/* Sidebar */}
      <div className="w-52 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
        {/* Header */}
        <div className="px-3 py-3 border-b border-sidebar-border flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-white/20 flex items-center justify-center flex-shrink-0">
            <Car className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-sidebar-foreground truncate">Fleet Scope</span>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-2">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                {group.label}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = item.href === "/";
                return (
                  <div
                    key={item.href}
                    className={`flex items-center gap-2 px-3 py-1.5 mx-1 rounded cursor-pointer transition-colors
                      ${active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
                      }`}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="text-xs truncate">{item.title}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* User footer */}
        <div className="px-3 py-2 border-t border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-sidebar-accent flex items-center justify-center text-[10px] font-bold text-sidebar-accent-foreground">
              FA
            </div>
            <span className="text-xs text-sidebar-foreground/70 truncate">fleet_agent</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Page header */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-background flex-shrink-0">
          <div>
            <h1 className="text-base font-semibold text-foreground">All Vehicles</h1>
            <p className="text-xs text-muted-foreground">Vehicle assignment status from Snowflake · 1,247 vehicles</p>
          </div>
          <button className="flex items-center gap-1.5 text-xs border border-border rounded-md px-3 py-1.5 hover:bg-muted transition-colors text-muted-foreground">
            <span>↺</span> Refresh
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-6 gap-3">
            {summaryCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className={`rounded-lg border border-border p-3 cursor-pointer hover:shadow-sm transition-shadow ${card.bg}`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className={`w-3.5 h-3.5 ${card.color}`} />
                    <span className="text-[10px] text-muted-foreground font-medium">{card.label}</span>
                  </div>
                  <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
                </div>
              );
            })}
          </div>

          {/* Table */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
              <span className="text-xs font-medium text-foreground">Vehicle Fleet</span>
              <div className="flex items-center gap-2">
                <input
                  className="text-xs border border-border rounded px-2 py-1 w-36 bg-background text-foreground placeholder:text-muted-foreground"
                  placeholder="Search vehicles..."
                />
                <button className="text-xs border border-border rounded px-2 py-1 bg-background text-muted-foreground hover:bg-muted">
                  Export
                </button>
              </div>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Vehicle #</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Sub-Status</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">District</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Location</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, i) => (
                  <tr
                    key={row.vehicle}
                    className={`border-b border-border hover:bg-muted/30 transition-colors cursor-pointer ${i % 2 === 0 ? "bg-background" : "bg-muted/10"}`}
                  >
                    <td className="px-3 py-2 font-mono font-medium text-foreground">{row.vehicle}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${row.badge}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.substatus}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.district}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
