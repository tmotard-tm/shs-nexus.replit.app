import { useState } from "react";
import {
  Car, Users, UserPlus, UserMinus, Plus, Settings, ArrowRight,
  CheckCircle, Clock, TrendingUp, Bell, Search, ChevronRight, Zap
} from "lucide-react";

const stats = {
  onboarding: { pending: 7, inProgress: 3, completed: 142 },
  vehicleAssignment: { pending: 12, inProgress: 5, completed: 891 },
  offboarding: { pending: 2, inProgress: 1, completed: 67 },
  activeUsers: 48,
};

const actions = [
  {
    id: "new-vehicle",
    label: "Create a New Vehicle",
    desc: "Add a vehicle to the fleet system",
    icon: <Plus className="h-7 w-7" />,
    bg: "bg-blue-50 dark:bg-blue-950/40",
    iconBg: "bg-blue-100 dark:bg-blue-900/60",
    iconColor: "text-blue-600",
    border: "border-blue-100 dark:border-blue-900/50",
    badge: null,
    primary: true,
  },
  {
    id: "assign-vehicle",
    label: "Assign or Update Vehicle",
    desc: "Manage fleet assignments",
    icon: <Car className="h-7 w-7" />,
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    iconBg: "bg-emerald-100 dark:bg-emerald-900/60",
    iconColor: "text-emerald-600",
    border: "border-emerald-100 dark:border-emerald-900/50",
    badge: "12",
    primary: true,
  },
  {
    id: "onboarding",
    label: "Start Onboarding",
    desc: "Process new employee hire",
    icon: <UserPlus className="h-7 w-7" />,
    bg: "bg-violet-50 dark:bg-violet-950/40",
    iconBg: "bg-violet-100 dark:bg-violet-900/60",
    iconColor: "text-violet-600",
    border: "border-violet-100 dark:border-violet-900/50",
    badge: "7",
    primary: true,
  },
  {
    id: "offboarding",
    label: "Start Offboarding",
    desc: "Process employee departure",
    icon: <UserMinus className="h-7 w-7" />,
    bg: "bg-rose-50 dark:bg-rose-950/40",
    iconBg: "bg-rose-100 dark:bg-rose-900/60",
    iconColor: "text-rose-600",
    border: "border-rose-100 dark:border-rose-900/50",
    badge: "2",
    primary: false,
  },
  {
    id: "fleet-management",
    label: "Fleet Management",
    desc: "Full fleet overview & tools",
    icon: <TrendingUp className="h-7 w-7" />,
    bg: "bg-amber-50 dark:bg-amber-950/40",
    iconBg: "bg-amber-100 dark:bg-amber-900/60",
    iconColor: "text-amber-600",
    border: "border-amber-100 dark:border-amber-900/50",
    badge: null,
    primary: false,
  },
  {
    id: "more",
    label: "More Tools",
    desc: "Integrations, reports & settings",
    icon: <Settings className="h-7 w-7" />,
    bg: "bg-slate-50 dark:bg-slate-900/40",
    iconBg: "bg-slate-100 dark:bg-slate-800",
    iconColor: "text-slate-500",
    border: "border-slate-100 dark:border-slate-800",
    badge: null,
    primary: false,
  },
];

const recentRequests = [
  { id: 1, type: "Vehicle Assignment", name: "J. Martinez — Unit #2341", status: "In Progress", statusColor: "text-blue-600 bg-blue-50", time: "2m ago" },
  { id: 2, type: "Onboarding", name: "K. Thompson — Technician", status: "Pending", statusColor: "text-amber-700 bg-amber-50", time: "14m ago" },
  { id: 3, type: "Offboarding", name: "R. Davis — Operations", status: "Completed", statusColor: "text-emerald-700 bg-emerald-50", time: "1h ago" },
  { id: 4, type: "Vehicle Assignment", name: "M. Patel — Unit #1123", status: "Completed", statusColor: "text-emerald-700 bg-emerald-50", time: "2h ago" },
];

export function ActionFirst() {
  const [searchFocused, setSearchFocused] = useState(false);

  return (
    <div className="min-h-screen bg-white font-sans flex flex-col">
      {/* Top nav */}
      <header className="border-b border-slate-100 px-4 sm:px-6 py-4 flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="text-base font-bold text-slate-900 tracking-tight">Nexus</span>
        </div>
        <div className="flex-1 max-w-xs">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${searchFocused ? "border-blue-400 bg-white shadow-sm" : "border-slate-200 bg-slate-50"}`}>
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search requests, vehicles..."
              className="bg-transparent outline-none text-slate-700 placeholder:text-slate-400 w-full text-sm"
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
            />
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-50">
            <Bell className="h-4 w-4" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full"></span>
          </button>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white text-xs font-semibold">AD</div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-8">
          {/* Greeting + stats strip */}
          <div>
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Good morning, Admin</h1>
            <p className="text-slate-500 text-sm">Fleet snapshot — Thursday, March 2026</p>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Vehicles to assign", value: stats.vehicleAssignment.pending, color: "text-blue-600", bgDot: "bg-blue-500" },
                { label: "Onboarding pending", value: stats.onboarding.pending, color: "text-violet-600", bgDot: "bg-violet-500" },
                { label: "Offboarding pending", value: stats.offboarding.pending, color: "text-rose-600", bgDot: "bg-rose-500" },
                { label: "Active users", value: stats.activeUsers, color: "text-emerald-600", bgDot: "bg-emerald-500" },
              ].map((s) => (
                <div key={s.label} className="bg-slate-50 rounded-xl p-3 flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${s.bgDot} flex-shrink-0`}></div>
                  <div>
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-slate-500 leading-tight">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action cards — hero section */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">What do you need to do?</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {actions.map((action) => (
                <button
                  key={action.id}
                  className={`group relative text-left rounded-2xl border p-5 ${action.bg} ${action.border} hover:shadow-md hover:-translate-y-0.5 transition-all`}
                >
                  {action.badge && (
                    <span className="absolute top-4 right-4 min-w-[1.25rem] h-5 px-1 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center">
                      {action.badge}
                    </span>
                  )}
                  <div className={`w-12 h-12 rounded-xl ${action.iconBg} ${action.iconColor} flex items-center justify-center mb-4`}>
                    {action.icon}
                  </div>
                  <h3 className="font-semibold text-slate-900 text-sm mb-1">{action.label}</h3>
                  <p className="text-xs text-slate-500 mb-3">{action.desc}</p>
                  <div className="flex items-center gap-1 text-xs font-medium text-slate-700 group-hover:gap-2 transition-all">
                    Get started <ArrowRight className="h-3 w-3" />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Recent requests */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">Recent Requests</h2>
              <button className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1">
                View all <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              {recentRequests.map((r) => (
                <div key={r.id} className="flex items-center gap-4 px-4 py-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50/50 transition-colors cursor-pointer">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-500 mb-0.5">{r.type}</p>
                    <p className="text-sm font-medium text-slate-800 truncate">{r.name}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.statusColor} flex-shrink-0`}>{r.status}</span>
                  <span className="text-xs text-slate-400 flex-shrink-0">{r.time}</span>
                  <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
