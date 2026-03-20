import { useState } from "react";
import {
  Car, UserPlus, UserMinus, Users, BarChart3, Wifi, CheckCircle,
  Clock, AlertTriangle, Plus, ArrowRight, Bell, Zap, ChevronRight,
  TrendingUp, Activity, Settings
} from "lucide-react";

type Tab = "overview" | "fleet" | "people" | "requests" | "system";

const tabs: { id: Tab; label: string; icon: any; badge?: number }[] = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "fleet", label: "Fleet", icon: Car, badge: 12 },
  { id: "people", label: "People", icon: Users, badge: 9 },
  { id: "requests", label: "Requests", icon: Activity },
  { id: "system", label: "System", icon: Wifi },
];

export function OperationsHub() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 pt-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-sm">
              <Zap className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900 leading-none">Nexus Fleet</h1>
              <p className="text-xs text-slate-500 leading-none mt-0.5">Operations Hub</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="relative p-2 rounded-lg hover:bg-slate-50 text-slate-500">
              <Bell className="h-4 w-4" />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-rose-500 rounded-full"></span>
            </button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-sm">AD</div>
          </div>
        </div>

        {/* Tab bar */}
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                  active
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
                {tab.badge && (
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center ${active ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Tab content */}
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        {activeTab === "overview" && <OverviewTab />}
        {activeTab === "fleet" && <FleetTab />}
        {activeTab === "people" && <PeopleTab />}
        {activeTab === "requests" && <RequestsTab />}
        {activeTab === "system" && <SystemTab />}
      </main>
    </div>
  );
}

function OverviewTab() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Vehicles to Assign", value: 12, color: "text-blue-600", bg: "bg-blue-50", icon: <Car className="h-4 w-4 text-blue-500" /> },
          { label: "Onboarding Pending", value: 7, color: "text-violet-600", bg: "bg-violet-50", icon: <UserPlus className="h-4 w-4 text-violet-500" /> },
          { label: "Offboarding Active", value: 3, color: "text-rose-600", bg: "bg-rose-50", icon: <UserMinus className="h-4 w-4 text-rose-500" /> },
          { label: "Active Users", value: 48, color: "text-emerald-600", bg: "bg-emerald-50", icon: <Users className="h-4 w-4 text-emerald-500" /> },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} rounded-2xl p-4`}>
            <div className="flex items-center justify-between mb-2">{s.icon}</div>
            <div className={`text-3xl font-bold ${s.color} leading-none mb-1`}>{s.value}</div>
            <div className="text-xs text-slate-600">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-800 mb-4 text-sm">Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "Create Vehicle Entry", desc: "Add to fleet system", color: "text-blue-600" },
            { label: "Start Onboarding", desc: "New hire workflow", color: "text-violet-600" },
            { label: "Manage Fleet", desc: "Assignments & updates", color: "text-emerald-600" },
          ].map((a) => (
            <button key={a.label} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-all group">
              <div>
                <p className={`text-sm font-medium ${a.color}`}>{a.label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{a.desc}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800 text-sm">Recent Activity</h3>
          <button className="text-xs text-blue-600 hover:text-blue-700">View all</button>
        </div>
        <div className="divide-y divide-slate-50">
          {[
            { action: "Vehicle #2341 assigned to J. Martinez", type: "Fleet", time: "2m ago", ok: true },
            { action: "TPMS alert: Unit #1887 pressure low", type: "Alert", time: "31m ago", ok: false },
            { action: "Onboarding started — K. Thompson", type: "People", time: "14m ago", ok: true },
            { action: "R. Davis offboarding completed", type: "People", time: "1h ago", ok: true },
          ].map((a, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.ok ? "bg-emerald-500" : "bg-amber-400"}`}></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700 truncate">{a.action}</p>
              </div>
              <span className="text-xs text-slate-400 flex-shrink-0">{a.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FleetTab() {
  const vehicles = [
    { unit: "#4421", driver: "Unassigned", status: "Pending", location: "Depot A", priority: true },
    { unit: "#2341", driver: "J. Martinez", status: "In Progress", location: "Route 7", priority: true },
    { unit: "#3308", driver: "Unassigned", status: "Pending", location: "Depot B", priority: false },
    { unit: "#1887", driver: "T. Jackson", status: "Alert", location: "I-95 N", priority: true },
    { unit: "#2200", driver: "M. Patel", status: "Active", location: "Route 12", priority: false },
    { unit: "#3210", driver: "Decommissioned", status: "Archived", location: "—", priority: false },
  ];
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Fleet Management</h2>
        <button className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
          <Plus className="h-3.5 w-3.5" /> New Vehicle
        </button>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Unit</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 hidden sm:table-cell">Driver</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 hidden md:table-cell">Location</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {vehicles.map((v) => (
              <tr key={v.unit} className="hover:bg-slate-50/60 transition-colors cursor-pointer">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {v.priority && <div className="w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0"></div>}
                    <span className="font-medium text-slate-800">{v.unit}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{v.driver}</td>
                <td className="px-4 py-3">
                  <StatusPill status={v.status} />
                </td>
                <td className="px-4 py-3 text-slate-500 hidden md:table-cell text-xs">{v.location}</td>
                <td className="px-4 py-3 text-right">
                  <ChevronRight className="h-4 w-4 text-slate-300 ml-auto" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PeopleTab() {
  const items = [
    { name: "K. Thompson", type: "Onboarding", role: "Technician", step: "2/5", status: "In Progress" },
    { name: "S. Rodriguez", type: "Onboarding", role: "Driver", step: "1/5", status: "Pending" },
    { name: "A. Wilson", type: "Offboarding", role: "Operations", step: "2/4", status: "In Progress" },
    { name: "R. Davis", type: "Offboarding", role: "Technician", step: "4/4", status: "Completed" },
  ];
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">People Workflows</h2>
        <div className="flex gap-2">
          <button className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 text-white text-xs font-medium rounded-lg hover:bg-violet-700 transition-colors">
            <UserPlus className="h-3.5 w-3.5" /> Onboard
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 text-white text-xs font-medium rounded-lg hover:bg-rose-700 transition-colors">
            <UserMinus className="h-3.5 w-3.5" /> Offboard
          </button>
        </div>
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.name} className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4 hover:border-slate-300 transition-colors cursor-pointer">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-semibold text-sm flex-shrink-0">
              {item.name.split(" ").map((n) => n[0]).join("")}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-800">{item.name}</p>
              <p className="text-xs text-slate-500">{item.role} · {item.type} · Step {item.step}</p>
            </div>
            <StatusPill status={item.status} />
            <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function RequestsTab() {
  const requests = [
    { id: "REQ-0091", title: "Vehicle Assignment — Unit #4421", requester: "L. Chen", status: "Pending", date: "Today 09:14" },
    { id: "REQ-0090", title: "Onboarding — K. Thompson", requester: "HR Admin", status: "In Progress", date: "Today 08:47" },
    { id: "REQ-0089", title: "TPMS Alert — Unit #1887", requester: "System", status: "Urgent", date: "Today 08:31" },
    { id: "REQ-0088", title: "Offboarding — A. Wilson", requester: "Manager", status: "In Progress", date: "Yesterday" },
    { id: "REQ-0087", title: "Decommission — Unit #3308", requester: "Fleet Admin", status: "Completed", date: "Yesterday" },
  ];
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <h2 className="font-semibold text-slate-800">All Requests</h2>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="divide-y divide-slate-50">
          {requests.map((r) => (
            <div key={r.id} className="flex items-center gap-4 px-4 py-3.5 hover:bg-slate-50/60 transition-colors cursor-pointer group">
              <span className="text-xs font-mono text-slate-400 flex-shrink-0 hidden sm:block">{r.id}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{r.title}</p>
                <p className="text-xs text-slate-400">{r.requester} · {r.date}</p>
              </div>
              <StatusPill status={r.status} />
              <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SystemTab() {
  const services = [
    { name: "API Gateway", status: "Healthy", uptime: "99.9%", ok: true },
    { name: "Snowflake DB", status: "Connected", uptime: "99.7%", ok: true },
    { name: "Holman API", status: "Active", uptime: "98.2%", ok: true },
    { name: "External APIs", status: "9/11 Active", uptime: "—", ok: false },
    { name: "Authentication", status: "Online", uptime: "100%", ok: true },
    { name: "TPMS Integration", status: "Monitoring", uptime: "99.5%", ok: true },
  ];
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <h2 className="font-semibold text-slate-800">System Status</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {services.map((s) => (
          <div key={s.name} className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full flex-shrink-0 ${s.ok ? "bg-emerald-500" : "bg-amber-400"} ${s.ok ? "" : "animate-pulse"}`}></div>
            <div className="flex-1">
              <p className="font-medium text-slate-800 text-sm">{s.name}</p>
              <p className={`text-xs ${s.ok ? "text-emerald-600" : "text-amber-600"}`}>{s.status}</p>
            </div>
            <span className="text-xs text-slate-400">{s.uptime}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: any = {
    "Pending": "bg-amber-50 text-amber-700",
    "In Progress": "bg-blue-50 text-blue-700",
    "Completed": "bg-emerald-50 text-emerald-700",
    "Active": "bg-emerald-50 text-emerald-700",
    "Alert": "bg-rose-50 text-rose-700",
    "Urgent": "bg-rose-50 text-rose-700",
    "Archived": "bg-slate-100 text-slate-500",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${styles[status] || "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}
