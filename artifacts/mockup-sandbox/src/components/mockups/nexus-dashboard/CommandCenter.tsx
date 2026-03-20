import { useState } from "react";
import {
  Car, Users, UserPlus, UserMinus, Plus, Settings, Activity,
  CheckCircle, Clock, AlertCircle, TrendingUp, Wifi, Database,
  Shield, Zap, ArrowRight, BarChart3, Menu, X, Bell
} from "lucide-react";

const stats = {
  onboarding: { pending: 7, inProgress: 3, completed: 142 },
  vehicleAssignment: { pending: 12, inProgress: 5, completed: 891 },
  offboarding: { pending: 2, inProgress: 1, completed: 67 },
  activeUsers: 48,
};

const recentActivity = [
  { id: 1, type: "vehicle", action: "Vehicle #2341 assigned to J. Martinez", time: "2m ago", status: "success" },
  { id: 2, type: "onboard", action: "Onboarding started for K. Thompson", time: "14m ago", status: "info" },
  { id: 3, type: "alert", action: "TPMS alert: Unit #1887 pressure low", time: "31m ago", status: "warning" },
  { id: 4, type: "offboard", action: "Offboarding completed: R. Davis", time: "1h ago", status: "success" },
  { id: 5, type: "vehicle", action: "Vehicle #3210 decommissioned", time: "2h ago", status: "muted" },
  { id: 6, type: "onboard", action: "Fleet sync completed — 1,204 records", time: "3h ago", status: "success" },
];

const services = [
  { name: "API Gateway", status: "healthy", color: "text-emerald-400" },
  { name: "Snowflake DB", status: "connected", color: "text-emerald-400" },
  { name: "External APIs", status: "9/11 Active", color: "text-amber-400" },
  { name: "Authentication", status: "online", color: "text-emerald-400" },
];

export function CommandCenter() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top bar */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800"
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-blue-500 flex items-center justify-center">
              <Zap className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-semibold text-sm tracking-wide">NEXUS</span>
            <span className="text-slate-600 hidden sm:block">|</span>
            <span className="text-slate-400 text-sm hidden sm:block">Command Center</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="relative p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800">
            <Bell className="h-4 w-4" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-amber-400 rounded-full"></span>
          </button>
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">AD</div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <aside className={`
          ${sidebarOpen ? "flex" : "hidden"} lg:flex
          flex-col w-64 bg-slate-900 border-r border-slate-800 p-4 gap-4
          absolute lg:relative top-0 left-0 h-full z-20 lg:z-auto
        `}>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Fleet Overview</p>
            <div className="space-y-2">
              <MetricRow icon={<UserPlus className="h-4 w-4 text-violet-400" />} label="Onboarding" value={stats.onboarding.pending} sub="pending" color="text-violet-400" />
              <MetricRow icon={<Car className="h-4 w-4 text-blue-400" />} label="Vehicles" value={stats.vehicleAssignment.pending} sub="to assign" color="text-blue-400" />
              <MetricRow icon={<UserMinus className="h-4 w-4 text-rose-400" />} label="Offboarding" value={stats.offboarding.pending} sub="pending" color="text-rose-400" />
              <MetricRow icon={<Users className="h-4 w-4 text-emerald-400" />} label="Active Users" value={stats.activeUsers} sub="online" color="text-emerald-400" />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">System Status</p>
            <div className="space-y-2.5">
              {services.map((s) => (
                <div key={s.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${s.color === "text-emerald-400" ? "bg-emerald-400" : "bg-amber-400"} animate-pulse`}></div>
                    <span className="text-xs text-slate-400">{s.name}</span>
                  </div>
                  <span className={`text-xs font-medium ${s.color}`}>{s.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-auto space-y-1">
            {[
              { label: "Fleet Management", icon: <Car className="h-4 w-4" /> },
              { label: "Integrations", icon: <Wifi className="h-4 w-4" /> },
              { label: "Analytics", icon: <BarChart3 className="h-4 w-4" /> },
              { label: "Settings", icon: <Settings className="h-4 w-4" /> },
            ].map((item) => (
              <button key={item.label} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 text-sm transition-colors">
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto p-4 lg:p-6 space-y-6">
          {/* Quick actions */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { label: "New Vehicle", icon: <Plus className="h-5 w-5" />, color: "from-blue-600 to-blue-700", badge: null },
              { label: "Assign Vehicle", icon: <Car className="h-5 w-5" />, color: "from-emerald-600 to-emerald-700", badge: null },
              { label: "Onboard Hire", icon: <UserPlus className="h-5 w-5" />, color: "from-violet-600 to-violet-700", badge: "7" },
              { label: "Offboard", icon: <UserMinus className="h-5 w-5" />, color: "from-rose-600 to-rose-700", badge: "2" },
              { label: "More Tools", icon: <Settings className="h-5 w-5" />, color: "from-slate-600 to-slate-700", badge: null },
            ].map((a) => (
              <button
                key={a.label}
                className={`relative bg-gradient-to-b ${a.color} rounded-xl p-4 flex flex-col items-center gap-2 text-white hover:opacity-90 transition-opacity shadow-lg`}
              >
                {a.badge && (
                  <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-amber-400 text-slate-900 text-xs font-bold flex items-center justify-center">
                    {a.badge}
                  </span>
                )}
                {a.icon}
                <span className="text-xs font-medium text-center leading-tight">{a.label}</span>
              </button>
            ))}
          </div>

          {/* Progress strips */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ProgressCard
              title="Onboarding"
              pending={stats.onboarding.pending}
              inProgress={stats.onboarding.inProgress}
              completed={stats.onboarding.completed}
              color="violet"
            />
            <ProgressCard
              title="Vehicle Assignment"
              pending={stats.vehicleAssignment.pending}
              inProgress={stats.vehicleAssignment.inProgress}
              completed={stats.vehicleAssignment.completed}
              color="blue"
            />
            <ProgressCard
              title="Offboarding"
              pending={stats.offboarding.pending}
              inProgress={stats.offboarding.inProgress}
              completed={stats.offboarding.completed}
              color="rose"
            />
          </div>

          {/* Activity feed */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-400" />
                <h3 className="font-semibold text-sm">Live Activity Feed</h3>
              </div>
              <button className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                View all <ArrowRight className="h-3 w-3" />
              </button>
            </div>
            <div className="divide-y divide-slate-800/50">
              {recentActivity.map((item) => (
                <div key={item.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-800/40 transition-colors">
                  <StatusDot status={item.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-300 leading-snug">{item.action}</p>
                  </div>
                  <span className="text-xs text-slate-600 whitespace-nowrap flex-shrink-0">{item.time}</span>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function MetricRow({ icon, label, value, sub, color }: any) {
  return (
    <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-slate-300">{label}</span>
      </div>
      <div className="text-right">
        <span className={`text-sm font-bold ${color}`}>{value}</span>
        <span className="text-xs text-slate-600 ml-1">{sub}</span>
      </div>
    </div>
  );
}

function ProgressCard({ title, pending, inProgress, completed, color }: any) {
  const total = pending + inProgress + completed;
  const pct = Math.round((completed / total) * 100);
  const colors: any = {
    violet: { bar: "bg-violet-500", text: "text-violet-400" },
    blue: { bar: "bg-blue-500", text: "text-blue-400" },
    rose: { bar: "bg-rose-500", text: "text-rose-400" },
  };
  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-slate-300">{title}</h4>
        <span className={`text-sm font-bold ${colors[color].text}`}>{pct}%</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full mb-3">
        <div className={`h-full ${colors[color].bar} rounded-full`} style={{ width: `${pct}%` }}></div>
      </div>
      <div className="flex justify-between text-xs text-slate-500">
        <span><span className="text-amber-400 font-medium">{pending}</span> pending</span>
        <span><span className="text-blue-400 font-medium">{inProgress}</span> active</span>
        <span><span className="text-emerald-400 font-medium">{completed}</span> done</span>
      </div>
    </div>
  );
}

function StatusDot({ status }: any) {
  const colors: any = {
    success: "bg-emerald-500",
    warning: "bg-amber-400",
    info: "bg-blue-400",
    muted: "bg-slate-600",
  };
  return <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${colors[status] || "bg-slate-600"}`}></div>;
}
