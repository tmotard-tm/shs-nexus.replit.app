import { useState } from "react";
import { LayoutGrid, UserMinus, UserPlus, MapPin, Plus, Wrench, CalendarPlus, CalendarMinus, ArrowRight } from "lucide-react";

const actions = [
  {
    label: "Task Queue",
    desc: "4 items need attention",
    icon: LayoutGrid,
    color: "#4B5563",
    gradient: "from-gray-700 to-gray-900",
    badge: "4",
  },
  {
    label: "Offboarding",
    desc: "Process employee departures",
    icon: UserMinus,
    color: "#DC2626",
    gradient: "from-red-700 to-red-900",
  },
  {
    label: "Onboarding",
    desc: "Start a new hire workflow",
    icon: UserPlus,
    color: "#7C3AED",
    gradient: "from-purple-700 to-purple-900",
  },
  {
    label: "Fleet Management",
    desc: "Assign & update vehicles",
    icon: MapPin,
    color: "#16A34A",
    gradient: "from-green-700 to-green-900",
  },
  {
    label: "Weekly Onboarding",
    desc: "Batch weekly processing",
    icon: CalendarPlus,
    color: "#0891B2",
    gradient: "from-cyan-700 to-cyan-900",
  },
  {
    label: "Weekly Offboarding",
    desc: "Batch weekly processing",
    icon: CalendarMinus,
    color: "#E11D48",
    gradient: "from-rose-700 to-rose-900",
  },
  {
    label: "Create New Vehicle",
    desc: "Add a vehicle to the fleet",
    icon: Plus,
    color: "#2563EB",
    gradient: "from-blue-700 to-blue-900",
  },
  {
    label: "Fleet Scope",
    desc: "Rentals, repairs & decommissions",
    icon: Wrench,
    color: "#D97706",
    gradient: "from-amber-700 to-amber-900",
  },
];

export function FullscreenTiles() {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div
      className="relative w-full h-screen overflow-hidden"
      style={{
        backgroundImage: "url(/__mockup/images/van.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Strong overlay so tiles read clearly against the van */}
      <div className="absolute inset-0 bg-black/65 pointer-events-none" />

      <div className="relative z-10 h-full flex flex-col px-8 py-8">
        {/* Top: tagline */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Nexus: Your Business, Synced.</h1>
          <p className="text-white/40 text-sm mt-0.5">Choose a workflow to get started</p>
        </div>

        {/* 4 × 2 tile grid filling remaining space */}
        <div className="flex-1 grid grid-cols-4 grid-rows-2 gap-4">
          {actions.map((a) => {
            const Icon = a.icon;
            const isHovered = hovered === a.label;
            return (
              <button
                key={a.label}
                onMouseEnter={() => setHovered(a.label)}
                onMouseLeave={() => setHovered(null)}
                className="relative flex flex-col justify-between p-5 rounded-2xl text-left transition-all duration-200 overflow-hidden"
                style={{
                  background: isHovered
                    ? `linear-gradient(135deg, ${a.color}99, ${a.color}44)`
                    : "rgba(255,255,255,0.07)",
                  border: `1px solid ${isHovered ? a.color + "80" : "rgba(255,255,255,0.12)"}`,
                  backdropFilter: "blur(12px)",
                  transform: isHovered ? "translateY(-3px)" : "none",
                  boxShadow: isHovered ? `0 16px 40px ${a.color}30` : "none",
                }}
              >
                {/* Badge */}
                {a.badge && (
                  <span
                    className="absolute top-3 right-3 text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: a.color, color: "white" }}
                  >
                    {a.badge}
                  </span>
                )}

                {/* Icon */}
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-auto"
                  style={{ backgroundColor: a.color }}
                >
                  <Icon className="h-5 w-5 text-white" />
                </div>

                {/* Label + desc + arrow */}
                <div>
                  <p className="text-white font-semibold text-sm mb-0.5">{a.label}</p>
                  <p className="text-white/50 text-xs leading-snug">{a.desc}</p>
                  {isHovered && (
                    <div className="flex items-center gap-1 mt-2 text-white/70 text-xs">
                      Open <ArrowRight className="h-3 w-3" />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
