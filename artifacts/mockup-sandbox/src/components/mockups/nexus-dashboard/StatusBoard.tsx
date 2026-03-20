import { useState } from "react";
import {
  Car, UserPlus, UserMinus, AlertTriangle, CheckCircle2,
  Clock, Filter, RefreshCw, Bell, Zap, MoreVertical, ArrowUpRight
} from "lucide-react";

const columns = [
  {
    id: "pending",
    label: "Pending",
    color: "border-t-amber-400",
    headerBg: "bg-amber-50",
    headerText: "text-amber-700",
    dotColor: "bg-amber-400",
    cards: [
      { id: 1, type: "Vehicle", title: "Assign Unit #4421", sub: "Requested by L. Chen", priority: "high", time: "Just now" },
      { id: 2, type: "Onboarding", title: "K. Thompson — Technician", sub: "Start date: Mar 25", priority: "medium", time: "14m ago" },
      { id: 3, type: "Vehicle", title: "Assign Unit #3308", sub: "Requested by R. Okafor", priority: "low", time: "1h ago" },
      { id: 4, type: "Onboarding", title: "S. Rodriguez — Driver", sub: "Start date: Mar 27", priority: "low", time: "2h ago" },
      { id: 5, type: "Vehicle", title: "Decommission #1102", sub: "Scheduled removal", priority: "medium", time: "3h ago" },
    ],
  },
  {
    id: "inprogress",
    label: "In Progress",
    color: "border-t-blue-500",
    headerBg: "bg-blue-50",
    headerText: "text-blue-700",
    dotColor: "bg-blue-500",
    cards: [
      { id: 6, type: "Vehicle", title: "Assign Unit #2341 → Martinez", sub: "Awaiting Holman sync", priority: "high", time: "2m ago" },
      { id: 7, type: "Offboarding", title: "A. Wilson — Operations", sub: "Step 2 of 4", priority: "medium", time: "45m ago" },
      { id: 8, type: "Onboarding", title: "P. Nguyen — Coordinator", sub: "Step 3 of 5", priority: "medium", time: "1h ago" },
      { id: 9, type: "TPMS", title: "#1887 Pressure Alert", sub: "Investigation ongoing", priority: "high", time: "31m ago" },
    ],
  },
  {
    id: "completed",
    label: "Completed Today",
    color: "border-t-emerald-500",
    headerBg: "bg-emerald-50",
    headerText: "text-emerald-700",
    dotColor: "bg-emerald-500",
    cards: [
      { id: 10, type: "Offboarding", title: "R. Davis — Technician", sub: "All steps complete", priority: "low", time: "1h ago" },
      { id: 11, type: "Vehicle", title: "Unit #3210 Decommissioned", sub: "Archived in system", priority: "low", time: "2h ago" },
      { id: 12, type: "Onboarding", title: "T. Jackson — Driver", sub: "Vehicle + badge issued", priority: "low", time: "3h ago" },
      { id: 13, type: "Vehicle", title: "Assign Unit #2200 → Patel", sub: "Synced to Holman", priority: "low", time: "4h ago" },
    ],
  },
];

const typeConfig: any = {
  Vehicle: { icon: <Car className="h-3 w-3" />, color: "bg-blue-100 text-blue-700" },
  Onboarding: { icon: <UserPlus className="h-3 w-3" />, color: "bg-violet-100 text-violet-700" },
  Offboarding: { icon: <UserMinus className="h-3 w-3" />, color: "bg-rose-100 text-rose-700" },
  TPMS: { icon: <AlertTriangle className="h-3 w-3" />, color: "bg-amber-100 text-amber-700" },
};

const priorityConfig: any = {
  high: "bg-rose-100 text-rose-600",
  medium: "bg-amber-100 text-amber-600",
  low: "bg-slate-100 text-slate-500",
};

type FilterType = "All" | "Vehicle" | "Onboarding" | "Offboarding" | "TPMS";

export function StatusBoard() {
  const [activeFilter, setActiveFilter] = useState<FilterType>("All");
  const filters: FilterType[] = ["All", "Vehicle", "Onboarding", "Offboarding", "TPMS"];

  const filteredColumns = columns.map((col) => ({
    ...col,
    cards: activeFilter === "All" ? col.cards : col.cards.filter((c) => c.type === activeFilter),
  }));

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-800 to-slate-600 flex items-center justify-center">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <div>
            <span className="text-sm font-bold text-slate-900">Nexus</span>
            <span className="text-slate-400 mx-2">·</span>
            <span className="text-sm text-slate-500">Operations Board</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors">
            <RefreshCw className="h-3 w-3" />
            <span className="hidden sm:inline">Sync</span>
          </button>
          <button className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-50">
            <Bell className="h-4 w-4" />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-rose-500 rounded-full"></span>
          </button>
          <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-white text-xs font-semibold">AD</div>
        </div>
      </header>

      {/* Sub-header: summary strip */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-2 flex items-center gap-6 overflow-x-auto">
        {[
          { label: "Total Open", value: 9, color: "text-slate-900" },
          { label: "High Priority", value: 3, color: "text-rose-600" },
          { label: "Vehicles", value: 5, color: "text-blue-600" },
          { label: "People", value: 4, color: "text-violet-600" },
        ].map((m) => (
          <div key={m.label} className="flex items-center gap-2 whitespace-nowrap">
            <span className={`text-lg font-bold ${m.color}`}>{m.value}</span>
            <span className="text-xs text-slate-500">{m.label}</span>
          </div>
        ))}

        {/* Filters */}
        <div className="ml-auto flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                activeFilter === f
                  ? "bg-slate-800 text-white"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban columns */}
      <div className="flex-1 overflow-x-auto p-4 sm:p-6">
        <div className="flex gap-4 h-full min-w-max sm:min-w-0 sm:grid sm:grid-cols-3">
          {filteredColumns.map((col) => (
            <div key={col.id} className="flex flex-col w-72 sm:w-auto bg-slate-200/60 rounded-2xl overflow-hidden">
              {/* Column header */}
              <div className={`flex items-center justify-between px-4 py-3 border-t-4 ${col.color} bg-white`}>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${col.dotColor}`}></div>
                  <span className={`text-sm font-semibold ${col.headerText}`}>{col.label}</span>
                </div>
                <span className="bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">
                  {col.cards.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {col.cards.length === 0 ? (
                  <div className="flex items-center justify-center h-24 text-slate-400 text-sm">
                    <CheckCircle2 className="h-5 w-5 mr-2 opacity-50" /> No items
                  </div>
                ) : col.cards.map((card) => (
                  <div key={card.id} className="bg-white rounded-xl p-3.5 shadow-sm border border-slate-200/80 hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${typeConfig[card.type]?.color}`}>
                        {typeConfig[card.type]?.icon}
                        {card.type}
                      </span>
                      <button className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-400 hover:text-slate-600 transition-opacity">
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="text-sm font-medium text-slate-800 leading-snug mb-1">{card.title}</p>
                    <p className="text-xs text-slate-500 mb-2.5">{card.sub}</p>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${priorityConfig[card.priority]}`}>
                        {card.priority}
                      </span>
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {card.time}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
