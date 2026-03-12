import { MapPin, UserPlus, UserMinus, Plus, LayoutGrid, CalendarPlus, CalendarMinus, Wrench, Truck, PhoneCall, DollarSign, BarChart3, Car } from "lucide-react";

const existingTiles = [
  { label: "Task Queue",         icon: LayoutGrid,    color: "bg-gray-600" },
  { label: "Offboarding",        icon: UserMinus,     color: "bg-red-600" },
  { label: "Onboarding",         icon: UserPlus,      color: "bg-purple-600" },
  { label: "Fleet Management",   icon: MapPin,        color: "bg-green-600" },
  { label: "Weekly Onboarding",  icon: CalendarPlus,  color: "bg-cyan-600" },
  { label: "Weekly Offboarding", icon: CalendarMinus, color: "bg-rose-600" },
  { label: "Create New Vehicle", icon: Plus,          color: "bg-blue-600" },
];

const fleetScopeTile = {
  label: "Fleet Scope",
  icon: Wrench,
  color: "bg-amber-600",
  isNew: true,
};

const allTiles = [...existingTiles, fleetScopeTile];

const stats = [
  { label: "Active Vehicles", value: "1,247", sub: "total fleet", color: "text-blue-400" },
  { label: "Assigned", value: "1,103", sub: "to technicians", color: "text-green-400" },
  { label: "Unassigned", value: "144", sub: "available", color: "text-amber-400" },
  { label: "In Repair", value: "38", sub: "via Fleet Scope", color: "text-orange-400", isNew: true },
];

export function LandingPage() {
  return (
    <div
      className="min-h-screen relative flex flex-col"
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 40%, #0f2942 100%)",
        fontFamily: "'Poppins', system-ui, sans-serif",
      }}
    >
      {/* Subtle grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-8 pt-6 pb-4">
        <div className="flex items-center gap-3">
          {/* hamburger button placeholder */}
          <div className="w-10 h-10 rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm flex items-center justify-center">
            <div className="flex flex-col gap-1">
              <span className="block w-4 h-0.5 bg-white/80 rounded" />
              <span className="block w-4 h-0.5 bg-white/80 rounded" />
              <span className="block w-4 h-0.5 bg-white/80 rounded" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center">
            <Car className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-semibold text-lg tracking-tight" style={{ fontFamily: "'Montserrat', system-ui, sans-serif" }}>
            Nexus
          </span>
        </div>

        <div className="w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
          <span className="text-white text-xs font-semibold">FA</span>
        </div>
      </div>

      {/* Hero text */}
      <div className="relative z-10 text-center pt-8 pb-6 px-8">
        <h1 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: "'Montserrat', system-ui, sans-serif" }}>
          Fleet Command Center
        </h1>
        <p className="text-blue-200/70 text-sm">Select a workflow to begin</p>
      </div>

      {/* Stats row */}
      <div className="relative z-10 grid grid-cols-4 gap-4 px-8 mb-8">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`rounded-xl border p-4 backdrop-blur-sm relative ${
              s.isNew
                ? "border-amber-500/50 bg-amber-500/10"
                : "border-white/10 bg-white/5"
            }`}
          >
            {s.isNew && (
              <span className="absolute top-2 right-2 text-[10px] font-semibold bg-amber-500 text-white px-1.5 py-0.5 rounded-full">
                NEW
              </span>
            )}
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-white text-xs font-medium mt-0.5">{s.label}</p>
            <p className="text-white/40 text-xs">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Quick Actions card */}
      <div className="relative z-10 mx-8 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6">
        <p className="text-white/50 text-xs uppercase tracking-wider font-semibold mb-4">Quick Actions</p>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(8, minmax(0, 1fr))" }}
        >
          {allTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <button
                key={tile.label}
                className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border transition-all cursor-pointer group
                  ${"isNew" in tile && tile.isNew
                    ? "border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/20"
                    : "border-white/10 hover:border-white/30 hover:bg-white/10"
                  }`}
              >
                {"isNew" in tile && tile.isNew && (
                  <span className="absolute -top-2 -right-2 text-[9px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full shadow-lg">
                    NEW
                  </span>
                )}
                <div className={`w-10 h-10 rounded-lg ${tile.color} flex items-center justify-center shadow-lg`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <span className="text-white text-[11px] font-medium text-center leading-tight">
                  {tile.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom hint */}
      <div className="relative z-10 text-center mt-6 pb-6">
        <p className="text-white/30 text-xs">
          <span className="text-amber-400/70 font-medium">Fleet Scope</span>
          {" "}integration — repair pipeline, batch calling, decommissioning & more
        </p>
      </div>
    </div>
  );
}
