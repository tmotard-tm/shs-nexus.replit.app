import { MapPin, UserPlus, UserMinus, Plus, LayoutGrid, CalendarPlus, CalendarMinus, Wrench } from "lucide-react";

const existingTiles = [
  { label: "Task Queue",          icon: LayoutGrid,    color: "bg-gray-600" },
  { label: "Offboarding",         icon: UserMinus,     color: "bg-red-600" },
  { label: "Onboarding",          icon: UserPlus,      color: "bg-purple-600" },
  { label: "Fleet Management",    icon: MapPin,        color: "bg-green-600" },
  { label: "Weekly Onboarding",   icon: CalendarPlus,  color: "bg-cyan-600" },
  { label: "Weekly Offboarding",  icon: CalendarMinus, color: "bg-rose-600" },
  { label: "Create New Vehicle",  icon: Plus,          color: "bg-blue-600" },
];

const fleetScopeTile = {
  label: "Fleet Scope",
  icon: Wrench,
  color: "bg-amber-600",
};

const allTiles = [...existingTiles, fleetScopeTile];

export function LandingPage() {
  return (
    <div
      className="min-h-screen relative overflow-hidden"
      style={{ fontFamily: "'Poppins', system-ui, sans-serif" }}
    >
      {/* Van background simulation */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(160deg, #1a2840 0%, #223355 30%, #2d4a6a 55%, #1e3a5f 80%, #162030 100%)",
        }}
      />
      {/* subtle van silhouette */}
      <div className="absolute inset-0 flex items-end justify-center opacity-20 pointer-events-none select-none">
        <svg viewBox="0 0 900 320" className="w-full max-w-3xl" fill="white">
          <rect x="50" y="120" width="600" height="150" rx="24" />
          <rect x="30" y="160" width="90" height="90" rx="12" />
          <rect x="60" y="100" width="200" height="130" rx="14" />
          <rect x="270" y="130" width="360" height="100" rx="10" />
          <circle cx="180" cy="275" r="45" />
          <circle cx="500" cy="275" r="45" />
          <rect x="620" y="140" width="200" height="130" rx="14" />
          <circle cx="180" cy="275" r="26" fill="#1e3a5f" />
          <circle cx="500" cy="275" r="26" fill="#1e3a5f" />
        </svg>
      </div>

      {/* Background overlay */}
      <div className="absolute inset-0 bg-white/5" />

      {/* Main centered content */}
      <div className="relative z-10 max-w-4xl mx-auto pt-10 px-4">
        {/* Heading */}
        <div className="text-center mb-6">
          <h2
            className="text-3xl font-bold mb-3"
            style={{
              color: "#007bff",
              textShadow: "1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black",
              fontFamily: "'Montserrat', system-ui, sans-serif",
            }}
          >
            Welcome to Nexus
          </h2>
          <p
            className="text-lg"
            style={{
              color: "white",
              textShadow: "1px 1px 0 black, -1px -1px 0 black, 1px -1px 0 black, -1px 1px 0 black",
            }}
          >
            What can we help you with today?
          </p>
        </div>

        {/* Workflow Buttons Card */}
        <div className="rounded-xl border border-white/20 bg-white/95 shadow-xl p-6">
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: `repeat(${Math.min(allTiles.length, 5)}, minmax(0, 1fr))`,
            }}
          >
            {allTiles.map((tile, i) => {
              const Icon = tile.icon;
              const isFleetScope = tile.label === "Fleet Scope";
              return (
                <button
                  key={tile.label}
                  className={`relative flex flex-col items-center gap-2 p-4 rounded-lg transition-colors
                    ${isFleetScope
                      ? "hover:bg-amber-50 ring-2 ring-amber-400/60 bg-amber-50/40"
                      : "hover:bg-gray-100"
                    }`}
                >
                  {isFleetScope && (
                    <span
                      className="absolute -top-2 -right-2 text-[9px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full shadow"
                    >
                      NEW
                    </span>
                  )}
                  <div className={`w-12 h-12 rounded-lg ${tile.color} flex items-center justify-center shadow-md`}>
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <span className="text-xs text-center text-gray-700 font-medium leading-tight">
                    {tile.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
