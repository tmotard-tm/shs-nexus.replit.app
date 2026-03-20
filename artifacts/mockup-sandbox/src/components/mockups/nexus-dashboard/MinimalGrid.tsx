import { useState } from "react";
import {
  Car, UserPlus, UserMinus, Users, ArrowRight, ArrowUpRight,
  CheckCircle, Clock, AlertCircle, Minus, ChevronRight, Zap, Bell
} from "lucide-react";

const metrics = [
  { label: "Pending Assignments", value: 12, delta: +3, unit: "vehicles", accent: "#2563eb" },
  { label: "Onboarding Queue", value: 7, delta: -2, unit: "people", accent: "#7c3aed" },
  { label: "Active Offboardings", value: 3, delta: 0, unit: "in progress", accent: "#dc2626" },
  { label: "Fleet Utilization", value: "84%", delta: +2, unit: "of 1,204 units", accent: "#059669" },
  { label: "Active Users", value: 48, delta: +5, unit: "online now", accent: "#0891b2" },
  { label: "API Sync Status", value: "9/11", delta: 0, unit: "services up", accent: "#d97706" },
];

const queue = [
  { id: 1, category: "Vehicle", title: "Unit #4421 → L. Chen", status: "Pending", urgency: 0 },
  { id: 2, category: "Vehicle", title: "Unit #2341 → J. Martinez", status: "In Progress", urgency: 1 },
  { id: 3, category: "Onboarding", title: "K. Thompson (Technician)", status: "Pending", urgency: 0 },
  { id: 4, category: "TPMS", title: "#1887 Pressure Alert", status: "Urgent", urgency: 2 },
  { id: 5, category: "Offboarding", title: "A. Wilson — Step 2/4", status: "In Progress", urgency: 1 },
  { id: 6, category: "Vehicle", title: "Decommission #3308", status: "Pending", urgency: 0 },
];

const urgencyStyle: any = {
  0: { dot: "bg-slate-300", label: "bg-slate-100 text-slate-600" },
  1: { dot: "bg-blue-500", label: "bg-blue-50 text-blue-700" },
  2: { dot: "bg-rose-500 animate-pulse", label: "bg-rose-50 text-rose-700" },
};

export function MinimalGrid() {
  const [activeRow, setActiveRow] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-white flex flex-col font-['Inter',sans-serif]">
      {/* Minimal top bar */}
      <header className="border-b border-slate-100 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold tracking-tight text-slate-900 flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-slate-700" />
            Nexus
          </span>
          <div className="h-4 w-px bg-slate-200"></div>
          <span className="text-sm text-slate-400">Administrator Dashboard</span>
        </div>
        <div className="flex items-center gap-3">
          <button className="relative text-slate-400 hover:text-slate-600">
            <Bell className="h-4 w-4" />
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-rose-500 rounded-full"></span>
          </button>
          <div className="h-4 w-px bg-slate-200"></div>
          <span className="text-xs text-slate-500">Admin</span>
        </div>
      </header>

      <main className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-10">

          {/* Metrics grid */}
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Fleet Snapshot</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-slate-100 rounded-2xl overflow-hidden border border-slate-100">
              {metrics.map((m) => (
                <div key={m.label} className="bg-white p-4 flex flex-col gap-1 hover:bg-slate-50/80 transition-colors cursor-default">
                  <div className="text-2xl font-bold text-slate-900 leading-none" style={{ color: m.accent }}>
                    {m.value}
                  </div>
                  <div className="text-xs text-slate-500 leading-snug">{m.label}</div>
                  <div className="flex items-center gap-1 mt-1">
                    {m.delta > 0 ? (
                      <ArrowUpRight className="h-3 w-3 text-emerald-500" />
                    ) : m.delta < 0 ? (
                      <ArrowUpRight className="h-3 w-3 text-rose-500 rotate-90" />
                    ) : (
                      <Minus className="h-3 w-3 text-slate-300" />
                    )}
                    <span className={`text-xs ${m.delta > 0 ? "text-emerald-600" : m.delta < 0 ? "text-rose-600" : "text-slate-400"}`}>
                      {m.delta !== 0 ? `${m.delta > 0 ? "+" : ""}${m.delta}` : "Stable"} {m.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Workflow actions — minimal list */}
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Workflows</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { label: "New Vehicle", sub: "Create entry" },
                { label: "Assign Vehicle", sub: "12 pending" },
                { label: "Onboarding", sub: "7 in queue" },
                { label: "Offboarding", sub: "2 pending" },
                { label: "More Tools", sub: "Reports & integrations" },
              ].map((w, i) => (
                <button key={w.label} className="group text-left p-3.5 rounded-xl border border-slate-200 hover:border-slate-400 hover:shadow-sm transition-all">
                  <div className="text-sm font-medium text-slate-800 group-hover:text-slate-900">{w.label}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{w.sub}</div>
                  <div className="mt-2 flex items-center gap-1 text-xs text-slate-400 group-hover:text-slate-600 transition-colors">
                    Open <ArrowRight className="h-3 w-3" />
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Work queue table */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Active Queue</h2>
              <button className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
                View all <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            <div className="border border-slate-100 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 w-4"></th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400">Category</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400">Request</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 hidden sm:table-cell">Status</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-400"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {queue.map((item) => (
                    <tr
                      key={item.id}
                      onMouseEnter={() => setActiveRow(item.id)}
                      onMouseLeave={() => setActiveRow(null)}
                      className={`transition-colors cursor-pointer ${activeRow === item.id ? "bg-slate-50" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <div className={`w-1.5 h-1.5 rounded-full ${urgencyStyle[item.urgency].dot}`}></div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{item.category}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{item.title}</td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${urgencyStyle[item.urgency].label}`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ArrowRight className={`h-3.5 w-3.5 ml-auto text-slate-300 transition-colors ${activeRow === item.id ? "text-slate-500" : ""}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* System status strip */}
          <section>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">System</h2>
            <div className="flex flex-wrap gap-3">
              {["API Gateway · Healthy", "Snowflake · Connected", "External APIs · 9/11", "Auth · Online"].map((s) => {
                const isWarning = s.includes("9/11");
                return (
                  <div key={s} className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${isWarning ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${isWarning ? "bg-amber-400" : "bg-emerald-500"}`}></div>
                    {s}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
