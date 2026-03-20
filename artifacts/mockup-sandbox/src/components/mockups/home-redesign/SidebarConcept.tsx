import { useState } from "react";
import {
  Home, BarChart3, Clock, Settings, Activity, Key, HelpCircle,
  Wrench, Database, LayoutGrid, UserMinus, UserPlus, MapPin,
  Plus, CalendarPlus, CalendarMinus, LogOut, Users, Eye,
  ChevronRight, Menu, Sun, Moon, Bell,
  Car, Search, Truck, ParkingCircle, FileText, CheckCircle,
} from "lucide-react";

const navGroups = [
  {
    label: null,
    items: [
      { title: "Home", href: "/", icon: Home },
    ],
  },
  {
    label: "Dashboards",
    items: [
      { title: "Operations Dashboard", href: "/dashboard", icon: BarChart3 },
      { title: "Activity", href: "/activity", icon: Activity },
    ],
  },
  {
    label: "Queues",
    items: [
      { title: "Queue Management", href: "/queue-management", icon: Clock },
    ],
  },
  {
    label: "Management",
    items: [
      { title: "Fleet Management", href: "/fleet-management", icon: MapPin },
      { title: "Onboarding", href: "/onboard-hire", icon: UserPlus },
      { title: "Offboarding", href: "/offboard-technician", icon: UserMinus },
      { title: "Weekly Onboarding", href: "/weekly-onboarding", icon: CalendarPlus },
      { title: "Weekly Offboarding", href: "/weekly-offboarding", icon: CalendarMinus },
      { title: "Create New Vehicle", href: "/create-vehicle-location", icon: Plus },
    ],
  },
  {
    label: "Modules",
    items: [
      { title: "Fleet Scope", href: "/fleet-scope", icon: Wrench },
      { title: "TPMS", href: "/tpms", icon: Database },
    ],
  },
  {
    label: "Account",
    items: [
      { title: "Settings", href: "/settings", icon: Settings },
      { title: "Help & Tutorial", href: "/help", icon: HelpCircle },
    ],
  },
];

const quickActions = [
  { label: "Task Queue", icon: LayoutGrid, color: "#4B5563", badge: "4" },
  { label: "Offboarding", icon: UserMinus, color: "#DC2626" },
  { label: "Onboarding", icon: UserPlus, color: "#7C3AED" },
  { label: "Fleet Mgmt", icon: MapPin, color: "#16A34A" },
  { label: "Wkly Onboard", icon: CalendarPlus, color: "#0891B2" },
  { label: "Wkly Offboard", icon: CalendarMinus, color: "#E11D48" },
  { label: "New Vehicle", icon: Plus, color: "#2563EB" },
  { label: "Fleet Scope", icon: Wrench, color: "#D97706" },
];

export function SidebarConcept() {
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(false);
  const activeHref = "/";

  const sidebarW = collapsed ? 52 : 220;

  return (
    <div
      className="flex h-screen overflow-hidden text-sm"
      style={{ background: dark ? "#0f1117" : "#f5f5f7", color: dark ? "#e5e7eb" : "#111827" }}
    >
      {/* ── SIDEBAR ── */}
      <aside
        className="flex flex-col flex-shrink-0 h-full transition-all duration-200"
        style={{
          width: sidebarW,
          background: dark ? "#1a1d27" : "#ffffff",
          borderRight: `1px solid ${dark ? "#2d3044" : "#e5e7eb"}`,
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 h-12 px-3 border-b flex-shrink-0"
          style={{ borderColor: dark ? "#2d3044" : "#e5e7eb" }}
        >
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded transition-colors flex-shrink-0"
            style={{ color: dark ? "#9ca3af" : "#6b7280" }}
            title="Toggle sidebar"
          >
            <Menu className="h-4 w-4" />
          </button>
          {!collapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-[10px] font-bold">N</span>
              </div>
              <span className="font-semibold text-sm truncate" style={{ color: dark ? "#f3f4f6" : "#111827" }}>
                Nexus
              </span>
            </div>
          )}
          {collapsed && (
            <div className="w-6 h-6 rounded-lg bg-blue-600 flex items-center justify-center mx-auto">
              <span className="text-white text-[10px] font-bold">N</span>
            </div>
          )}
        </div>

        {/* Nav content */}
        <div className="flex-1 overflow-y-auto py-2">
          {navGroups.map((group, gi) => (
            <div key={gi} className="mb-1">
              {group.label && !collapsed && (
                <p
                  className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: dark ? "#6b7280" : "#9ca3af" }}
                >
                  {group.label}
                </p>
              )}
              {group.label && collapsed && gi > 0 && (
                <div className="mx-3 my-1 border-t" style={{ borderColor: dark ? "#2d3044" : "#e5e7eb" }} />
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = item.href === activeHref;
                return (
                  <button
                    key={item.href}
                    title={collapsed ? item.title : undefined}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 transition-colors"
                    style={{
                      background: active
                        ? dark ? "rgba(59,130,246,0.15)" : "rgba(59,130,246,0.08)"
                        : "transparent",
                      color: active
                        ? "#3b82f6"
                        : dark ? "#d1d5db" : "#374151",
                      borderRight: active ? "2px solid #3b82f6" : "2px solid transparent",
                    }}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {!collapsed && (
                      <span className="truncate text-sm font-medium">{item.title}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer — user */}
        <div
          className="border-t p-3 flex-shrink-0"
          style={{ borderColor: dark ? "#2d3044" : "#e5e7eb" }}
        >
          {!collapsed ? (
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                style={{ background: dark ? "#374151" : "#e5e7eb", color: dark ? "#d1d5db" : "#374151" }}
              >
                AD
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: dark ? "#f3f4f6" : "#111827" }}>Admin User</p>
                <p className="text-[10px] truncate" style={{ color: dark ? "#6b7280" : "#9ca3af" }}>developer</p>
              </div>
              <button style={{ color: dark ? "#6b7280" : "#9ca3af" }}>
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex justify-center">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
                style={{ background: dark ? "#374151" : "#e5e7eb", color: dark ? "#d1d5db" : "#374151" }}
              >
                AD
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ── CONTENT AREA ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div
          className="h-12 flex items-center px-4 gap-3 border-b flex-shrink-0"
          style={{
            background: dark ? "#1a1d27" : "#ffffff",
            borderColor: dark ? "#2d3044" : "#e5e7eb",
          }}
        >
          <div className="flex items-center gap-1 text-sm" style={{ color: dark ? "#6b7280" : "#9ca3af" }}>
            <Home className="h-3.5 w-3.5" />
            <span>/</span>
            <span style={{ color: dark ? "#f3f4f6" : "#111827" }} className="font-medium">Home</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setDark(!dark)}
              className="p-1.5 rounded transition-colors"
              style={{ color: dark ? "#9ca3af" : "#6b7280" }}
              title="Toggle dark mode"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button className="relative p-1.5 rounded" style={{ color: dark ? "#9ca3af" : "#6b7280" }}>
              <Bell className="h-4 w-4" />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full"></span>
            </button>
          </div>
        </div>

        {/* Van hero — fills all remaining height */}
        <div
          className="relative flex-1 overflow-hidden"
          style={{
            backgroundImage: "url(/__mockup/images/van.png)",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent pointer-events-none" />

          {/* Tagline */}
          <div className="relative z-10 pt-7 pl-7">
            <h1
              className="text-3xl font-bold leading-tight"
              style={{ color: "#ffffff", textShadow: "0 2px 12px rgba(0,0,0,0.7)" }}
            >
              Nexus:<br />Your Business,<br />Synced.
            </h1>
          </div>

          {/* Bottom action bar */}
          <div className="absolute bottom-0 left-0 right-0 z-10 px-5 pb-5">
            <div
              className="w-full rounded-2xl px-5 py-4 flex items-center gap-4"
              style={{
                background: "rgba(255,255,255,0.12)",
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.2)",
              }}
            >
              <div className="flex-shrink-0 pr-4 border-r border-white/20">
                <p className="text-white/60 text-[10px] uppercase tracking-widest font-medium">Quick Actions</p>
              </div>
              <div className="flex-1 grid grid-cols-8 gap-1.5">
                {quickActions.map((a) => {
                  const Icon = a.icon;
                  return (
                    <button key={a.label} className="relative flex flex-col items-center gap-1 group">
                      {a.badge && (
                        <span className="absolute -top-1 -right-1 z-10 text-[9px] bg-red-500 text-white w-3.5 h-3.5 rounded-full flex items-center justify-center">{a.badge}</span>
                      )}
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                        style={{ backgroundColor: a.color }}
                      >
                        <Icon className="h-4 w-4 text-white" />
                      </div>
                      <span className="text-white/75 text-[9px] text-center font-medium leading-tight group-hover:text-white transition-colors">{a.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
